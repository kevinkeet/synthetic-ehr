require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// --- Parse JSON bodies (up to 1MB for large prompts) ---
app.use(express.json({ limit: '1mb' }));

// --- Static file serving (frontend) ---
app.use(express.static(path.join(__dirname, '.')));

// --- Health check ---
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        apiConfigured: !!process.env.ANTHROPIC_API_KEY,
        deepgramConfigured: !!process.env.DEEPGRAM_API_KEY
    });
});

// --- Anthropic API proxy ---
app.post('/api/claude', async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: { message: 'ANTHROPIC_API_KEY not configured on server' }
        });
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Anthropic proxy error:', error.message);
        res.status(502).json({
            error: { message: 'Failed to reach Anthropic API: ' + error.message }
        });
    }
});

// --- Deepgram WebSocket relay ---
const wss = new WebSocket.Server({ server, path: '/ws/transcribe' });

wss.on('connection', (browserWs, req) => {
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (!dgKey) {
        browserWs.close(4001, 'DEEPGRAM_API_KEY not configured');
        return;
    }

    console.log('🎙️ Deepgram relay: browser connected');

    // Open upstream connection to Deepgram
    const dgUrl = 'wss://api.deepgram.com/v1/listen?' + [
        'model=nova-3',
        'diarize=true',
        'punctuate=true',
        'interim_results=true',
        'utterance_end_ms=1500',
        'encoding=linear16',
        'sample_rate=16000',
        'channels=1'
    ].join('&');

    const dgWs = new WebSocket(dgUrl, {
        headers: { 'Authorization': `Token ${dgKey}` }
    });

    let dgReady = false;

    dgWs.on('open', () => {
        dgReady = true;
        console.log('🎙️ Deepgram relay: upstream connected');
    });

    // Relay audio from browser → Deepgram
    browserWs.on('message', (data, isBinary) => {
        if (dgReady && dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(data);
        }
    });

    // Relay transcripts from Deepgram → browser
    dgWs.on('message', (data) => {
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(data.toString());
        }
    });

    // Browser disconnects → close Deepgram
    browserWs.on('close', () => {
        console.log('🎙️ Deepgram relay: browser disconnected');
        if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(JSON.stringify({ type: 'CloseStream' }));
            dgWs.close();
        }
    });

    // Deepgram disconnects → close browser
    dgWs.on('close', (code, reason) => {
        console.log(`🎙️ Deepgram relay: upstream closed (${code})`);
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.close();
        }
    });

    // Error handling
    dgWs.on('error', (err) => {
        console.error('🎙️ Deepgram relay error:', err.message);
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.close(4002, 'Deepgram connection error');
        }
    });

    browserWs.on('error', (err) => {
        console.error('🎙️ Browser WS error:', err.message);
        if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.close();
        }
    });
});

// --- Start server ---
server.listen(PORT, () => {
    console.log(`Acting Intern server running on http://localhost:${PORT}`);
    console.log(`Anthropic API key: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET'}`);
    console.log(`Deepgram API key: ${process.env.DEEPGRAM_API_KEY ? 'configured' : 'NOT SET'}`);
});
