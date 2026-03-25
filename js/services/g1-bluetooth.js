/**
 * Even Realities G1 Bluetooth Low Energy Driver
 *
 * Implements the G1 dual-BLE protocol for communicating with Even Realities
 * smart glasses directly from the browser via Web Bluetooth API.
 *
 * Architecture:
 * - G1 uses DUAL Bluetooth connections (left arm + right arm)
 * - Data must be sent left-first, then right after acknowledgment
 * - Display: 576×136 px monochrome, 488px usable during AI mode
 * - Text: paginated via 0x4E command, 5 lines per screen, 45 chars per line
 * - Images: 1-bit BMP, 576×136, sent via 0x15 command in 194-byte chunks
 * - Mic: LC3 audio via 0xF1, max 30 seconds
 *
 * Usage:
 *   await G1Bluetooth.connect()        — scan and pair
 *   G1Bluetooth.sendText(pages)        — send paginated text to display
 *   G1Bluetooth.sendImage(bmpData)     — send 1-bit BMP image
 *   G1Bluetooth.disconnect()           — clean disconnect
 *   G1Bluetooth.isConnected()          — check connection status
 *
 * References:
 *   https://github.com/even-realities/EvenDemoApp
 */
const G1Bluetooth = {
    // Connection state
    _leftDevice: null,
    _rightDevice: null,
    _leftChar: null,    // GATT characteristic for left arm
    _rightChar: null,   // GATT characteristic for right arm
    _connected: false,
    _connecting: false,

    // G1 BLE identifiers (from EvenDemoApp protocol)
    SERVICE_UUID: '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e',
    TX_CHAR_UUID: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',  // Write to glasses
    RX_CHAR_UUID: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',  // Read from glasses

    // Display constants
    DISPLAY_WIDTH: 576,
    DISPLAY_HEIGHT: 136,
    AI_TEXT_WIDTH: 488,
    LINES_PER_SCREEN: 5,
    MAX_LINE_CHARS: 45,
    MAX_BLE_PACKET: 194,

    // Commands
    CMD_SEND_AI_RESULT: 0x4E,
    CMD_SEND_IMAGE: 0x15,
    CMD_IMAGE_END: 0x20,
    CMD_IMAGE_CRC: 0x16,
    CMD_MIC_ENABLE: 0x0E,

    // Screen status flags
    SCREEN_NEW: 0x01,
    SCREEN_AI_AUTO: 0x30,
    SCREEN_AI_DONE: 0x40,
    SCREEN_MANUAL: 0x50,
    SCREEN_TEXT: 0x70,

    // Event listeners
    _listeners: {},

    // ==================== Connection ====================

    /**
     * Connect to G1 glasses via Web Bluetooth.
     * The G1 has dual BLE — we connect to both left and right arms.
     * For now, we connect to a single device (the G1 appears as one device
     * but with two GATT services for L/R arms in some firmware versions).
     */
    async connect() {
        if (this._connected) {
            console.log('👓 G1: Already connected');
            return true;
        }
        if (this._connecting) {
            console.log('👓 G1: Connection already in progress');
            return false;
        }

        if (!navigator.bluetooth) {
            console.error('👓 G1: Web Bluetooth not available in this browser');
            this._emit('error', { message: 'Web Bluetooth not supported. Use Chrome or Edge.' });
            return false;
        }

        this._connecting = true;
        this._emit('connecting');

        try {
            console.log('👓 G1: Scanning for Even Realities glasses...');

            // Request device — filter by service UUID or name prefix
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { namePrefix: 'Even' },
                    { namePrefix: 'G1' },
                    { namePrefix: 'EVEN' },
                ],
                optionalServices: [this.SERVICE_UUID]
            });

            console.log('👓 G1: Found device:', device.name);
            this._leftDevice = device;

            // Listen for disconnection
            device.addEventListener('gattserverdisconnected', () => {
                console.log('👓 G1: Device disconnected');
                this._connected = false;
                this._leftChar = null;
                this._rightChar = null;
                this._emit('disconnected');
            });

            // Connect to GATT server
            const server = await device.gatt.connect();
            console.log('👓 G1: GATT connected');

            // Get the primary service
            const service = await server.getPrimaryService(this.SERVICE_UUID);
            console.log('👓 G1: Service found');

            // Get TX characteristic (write to glasses)
            this._leftChar = await service.getCharacteristic(this.TX_CHAR_UUID);
            console.log('👓 G1: TX characteristic ready');

            // Get RX characteristic (notifications from glasses)
            const rxChar = await service.getCharacteristic(this.RX_CHAR_UUID);
            await rxChar.startNotifications();
            rxChar.addEventListener('characteristicvaluechanged', (event) => {
                this._handleNotification(event.target.value);
            });
            console.log('👓 G1: RX notifications active');

            // For dual-BLE G1: the right arm may be a second device or a second
            // characteristic on the same service. For now, we use a single connection
            // and set rightChar = leftChar (many G1 firmwares work with single BLE).
            this._rightChar = this._leftChar;

            this._connected = true;
            this._connecting = false;
            this._emit('connected', { deviceName: device.name });
            console.log('👓 G1: Connected successfully to', device.name);

            return true;

        } catch (error) {
            this._connecting = false;
            this._connected = false;
            console.error('👓 G1: Connection failed:', error.message);
            this._emit('error', { message: error.message });

            if (error.name === 'NotFoundError') {
                // User cancelled the device picker
                return false;
            }
            throw error;
        }
    },

    /**
     * Disconnect from G1 glasses
     */
    disconnect() {
        if (this._leftDevice && this._leftDevice.gatt.connected) {
            this._leftDevice.gatt.disconnect();
        }
        this._connected = false;
        this._leftChar = null;
        this._rightChar = null;
        this._leftDevice = null;
        this._rightDevice = null;
        this._emit('disconnected');
        console.log('👓 G1: Disconnected');
    },

    /**
     * Check if connected
     */
    isConnected() {
        return this._connected && this._leftChar !== null;
    },

    // ==================== Text Display ====================

    /**
     * Send paginated text to the G1 display.
     * @param {Array<{title: string, lines: string[]}>} screens - Array of screen objects
     * Each screen has a title and up to 5 lines of ≤45 chars each.
     */
    async sendText(screens) {
        if (!this.isConnected()) {
            console.warn('👓 G1: Not connected — cannot send text');
            return false;
        }

        if (!screens || screens.length === 0) return false;

        console.log(`👓 G1: Sending ${screens.length} screens of text`);

        try {
            for (let pageIdx = 0; pageIdx < screens.length; pageIdx++) {
                const screen = screens[pageIdx];
                const isLast = pageIdx === screens.length - 1;

                // Build the text content for this screen
                let textContent = '';
                if (screen.title) {
                    textContent += screen.title + '\n';
                }
                if (screen.lines) {
                    textContent += screen.lines.join('\n');
                }

                // Encode to bytes
                const textBytes = new TextEncoder().encode(textContent);

                // Build command packet(s)
                // Split text into BLE-sized chunks (max ~180 bytes of text per packet)
                const MAX_TEXT_PER_PACKET = 180;
                const chunks = [];
                for (let i = 0; i < textBytes.length; i += MAX_TEXT_PER_PACKET) {
                    chunks.push(textBytes.slice(i, i + MAX_TEXT_PER_PACKET));
                }

                const totalPackages = chunks.length;

                for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
                    const chunk = chunks[chunkIdx];
                    const isFirstChunk = chunkIdx === 0;

                    // Build 0x4E command header
                    const newscreen = isFirstChunk
                        ? (isLast ? this.SCREEN_AI_DONE : this.SCREEN_AI_AUTO) | this.SCREEN_NEW
                        : 0x00;

                    const header = new Uint8Array([
                        this.CMD_SEND_AI_RESULT,
                        chunkIdx & 0xFF,           // seq
                        totalPackages & 0xFF,       // total_packages
                        (chunkIdx + 1) & 0xFF,     // current_package
                        newscreen,                   // screen status
                        0x00, 0x00,                  // position (high, low)
                        (pageIdx + 1) & 0xFF,       // current_page
                        screens.length & 0xFF,      // max_pages
                    ]);

                    // Combine header + text data
                    const packet = new Uint8Array(header.length + chunk.length);
                    packet.set(header, 0);
                    packet.set(chunk, header.length);

                    // Send to left arm
                    await this._writeChar(this._leftChar, packet);

                    // Small delay between packets for BLE stability
                    if (chunkIdx < chunks.length - 1) {
                        await this._delay(30);
                    }
                }

                // Delay between screens
                if (pageIdx < screens.length - 1) {
                    await this._delay(50);
                }
            }

            this._emit('textSent', { screenCount: screens.length });
            return true;

        } catch (error) {
            console.error('👓 G1: Text send failed:', error.message);
            this._emit('error', { message: 'Failed to send text: ' + error.message });
            return false;
        }
    },

    /**
     * Send a simple text string (auto-paginated)
     * @param {string} text — text to display, will be word-wrapped and paginated
     */
    async sendSimpleText(text) {
        const screens = this._paginateText(text);
        return this.sendText(screens);
    },

    /**
     * Send the clinical HUD data from the AI's glassesDisplay output.
     * This is the main integration point — takes the LLM-generated glasses data
     * and pushes it to the real hardware.
     * @param {object} glassesDisplay — { leftLens: [...screens], rightLens: [...screens] }
     */
    async sendClinicalHUD(glassesDisplay) {
        if (!this.isConnected() || !glassesDisplay) return false;

        const allScreens = [];

        // Left lens screens first
        if (glassesDisplay.leftLens) {
            glassesDisplay.leftLens.forEach(screen => {
                allScreens.push({
                    title: screen.title || '',
                    lines: (screen.lines || []).filter(l => l && l.trim())
                });
            });
        }

        // Then right lens screens
        if (glassesDisplay.rightLens) {
            glassesDisplay.rightLens.forEach(screen => {
                allScreens.push({
                    title: screen.title || '',
                    lines: (screen.lines || []).filter(l => l && l.trim())
                });
            });
        }

        if (allScreens.length === 0) return false;

        console.log(`👓 G1: Sending clinical HUD — ${allScreens.length} screens`);
        return this.sendText(allScreens);
    },

    // ==================== Image Display ====================

    /**
     * Send a 1-bit BMP image to the G1 display.
     * @param {Uint8Array} bmpData — raw 1-bit BMP image data (576×136)
     */
    async sendImage(bmpData) {
        if (!this.isConnected()) return false;

        try {
            // Step 1: Send image data in 194-byte packets
            const storageAddr = new Uint8Array([0x00, 0x1C, 0x00, 0x00]);
            const totalPackets = Math.ceil(bmpData.length / this.MAX_BLE_PACKET);

            for (let i = 0; i < totalPackets; i++) {
                const start = i * this.MAX_BLE_PACKET;
                const chunk = bmpData.slice(start, start + this.MAX_BLE_PACKET);

                let packet;
                if (i === 0) {
                    // First packet includes storage address
                    packet = new Uint8Array(1 + 1 + storageAddr.length + chunk.length);
                    packet[0] = this.CMD_SEND_IMAGE;
                    packet[1] = i & 0xFF;
                    packet.set(storageAddr, 2);
                    packet.set(chunk, 2 + storageAddr.length);
                } else {
                    packet = new Uint8Array(1 + 1 + chunk.length);
                    packet[0] = this.CMD_SEND_IMAGE;
                    packet[1] = i & 0xFF;
                    packet.set(chunk, 2);
                }

                await this._writeChar(this._leftChar, packet);
                await this._delay(20);
            }

            // Step 2: Send termination
            await this._writeChar(this._leftChar, new Uint8Array([0x20, 0x0D, 0x0E]));
            await this._delay(20);

            // Step 3: Send CRC
            const crc = this._crc32(bmpData, storageAddr);
            const crcPacket = new Uint8Array(5);
            crcPacket[0] = this.CMD_IMAGE_CRC;
            crcPacket[1] = (crc >> 24) & 0xFF;
            crcPacket[2] = (crc >> 16) & 0xFF;
            crcPacket[3] = (crc >> 8) & 0xFF;
            crcPacket[4] = crc & 0xFF;
            await this._writeChar(this._leftChar, crcPacket);

            this._emit('imageSent');
            return true;

        } catch (error) {
            console.error('👓 G1: Image send failed:', error.message);
            return false;
        }
    },

    // ==================== Microphone ====================

    /**
     * Enable the G1's right-arm microphone for voice capture.
     * Audio arrives as LC3 packets via notifications.
     */
    async enableMicrophone() {
        if (!this.isConnected()) return false;
        try {
            await this._writeChar(this._rightChar, new Uint8Array([this.CMD_MIC_ENABLE, 0x01]));
            this._emit('micEnabled');
            return true;
        } catch (error) {
            console.error('👓 G1: Mic enable failed:', error);
            return false;
        }
    },

    /**
     * Disable the G1 microphone.
     */
    async disableMicrophone() {
        if (!this.isConnected()) return false;
        try {
            await this._writeChar(this._rightChar, new Uint8Array([this.CMD_MIC_ENABLE, 0x00]));
            this._emit('micDisabled');
            return true;
        } catch (error) {
            console.error('👓 G1: Mic disable failed:', error);
            return false;
        }
    },

    // ==================== Event System ====================

    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    },

    off(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    },

    _emit(event, data) {
        (this._listeners[event] || []).forEach(cb => {
            try { cb(data); } catch (e) { console.error('G1 event handler error:', e); }
        });
    },

    // ==================== Internal Helpers ====================

    /**
     * Handle incoming BLE notification from glasses
     */
    _handleNotification(dataView) {
        const cmd = dataView.getUint8(0);

        switch (cmd) {
            case 0xF5: { // TouchBar event
                const action = dataView.getUint8(1);
                const actions = {
                    0x00: 'double_tap',    // Close/exit
                    0x01: 'single_tap',    // Navigate
                    0x04: 'triple_tap_on', // Silent mode on
                    0x05: 'triple_tap_off',// Silent mode off
                    0x17: 'ai_start',      // Long press → start AI
                    0x18: 'ai_stop',       // Stop recording
                };
                const name = actions[action] || `unknown_${action.toString(16)}`;
                console.log(`👓 G1: TouchBar event — ${name}`);
                this._emit('touchbar', { action: name, raw: action });
                break;
            }

            case 0xF1: { // Audio data
                const seq = dataView.getUint8(1);
                const audioData = new Uint8Array(dataView.buffer, 2);
                this._emit('audio', { seq, data: audioData });
                break;
            }

            case 0xC9: // Success acknowledgment
                this._emit('ack', { success: true });
                break;

            case 0xCA: // Failure acknowledgment
                this._emit('ack', { success: false });
                break;

            default:
                console.log(`👓 G1: Unknown notification cmd=0x${cmd.toString(16)}`);
        }
    },

    /**
     * Write data to a BLE characteristic with error handling
     */
    async _writeChar(char, data) {
        if (!char) throw new Error('BLE characteristic not available');
        await char.writeValueWithoutResponse(data);
    },

    /**
     * Paginate a text string into screens of 5 lines × 45 chars
     */
    _paginateText(text) {
        const words = text.split(/\s+/);
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
            if ((currentLine + ' ' + word).trim().length > this.MAX_LINE_CHARS) {
                if (currentLine) lines.push(currentLine.trim());
                currentLine = word;
            } else {
                currentLine = currentLine ? currentLine + ' ' + word : word;
            }
        });
        if (currentLine.trim()) lines.push(currentLine.trim());

        // Group into screens
        const screens = [];
        for (let i = 0; i < lines.length; i += this.LINES_PER_SCREEN) {
            screens.push({
                title: '',
                lines: lines.slice(i, i + this.LINES_PER_SCREEN)
            });
        }

        return screens.length > 0 ? screens : [{ title: '', lines: [''] }];
    },

    /**
     * CRC32-XZ calculation for image verification
     */
    _crc32(data, addr) {
        const combined = new Uint8Array(addr.length + data.length);
        combined.set(addr, 0);
        combined.set(data, addr.length);

        let crc = 0xFFFFFFFF;
        for (let i = 0; i < combined.length; i++) {
            crc ^= combined[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    },

    /**
     * Delay helper
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

// Export
window.G1Bluetooth = G1Bluetooth;
