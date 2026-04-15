// Acting Intern — G2 Clinical HUD v1.2
// Minimal + defensive — built from working v0.9 pattern
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';

let bridge = null;
let cur = 0;

const screens = [
  '━━ PATIENT ━━\n\n74M w/ HFrEF (EF 35%), T2DM on insulin,\npersistent AFib (not anticoagulated\ns/p major GI bleed 9/2023),\nCKD3b (Cr 1.8-2.0, eGFR 35-41),\nCAD 3-vessel (medically managed)\n\nNYHA II-III, independent ADLs\nWife Patricia manages meds\nStable on current regimen\n\nPress to see Problems >',
  '━━ PROBLEMS ━━\n\n! 1. Heart Failure (EF 35%)\n   GDMT: Entresto, Carvedilol, Spiro\n! 2. CKD Stage 3b\n   Cr 1.96, eGFR 36 - stable\n! 3. Type 2 Diabetes\n   A1c 7.4%, on insulin\n! 4. Atrial Fibrillation\n   Rate-controlled, ASA only\n  5. CAD 3-vessel\n   Medically managed\n\nPress to see Orders >',
  '━━ ORDERS ━━\n\nLAB: BMP, CBC, BNP\nLAB: Hemoglobin A1c\nIMG: Echocardiogram\nASK: Dietary sodium compliance?\nASK: Daily weight monitoring?\n\nPress to see Alerts >',
  '━━ ALERTS ━━\n\n! PCN allergy - ANAPHYLAXIS\n! Lisinopril - ANGIOEDEMA\n! No anticoagulation (GI bleed hx)\n- CKD: adjust renal dosing\n- Fall risk: neuropathy + polypharm\n\nPress to see Patient >',
];

async function main() {
  bridge = await waitForEvenAppBridge();

  await bridge.createStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [{
      xPosition: 0, yPosition: 0, width: 576, height: 288,
      borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0,
      containerID: 1, containerName: 'main',
      content: screens[0],
      isEventCapture: 1,
    }],
  });

  // Use try/catch for event handling in case OsEventTypeList is problematic
  try {
    bridge.onEvenHubEvent(function(event) {
      try {
        var te = event.textEvent;
        if (!te) return;
        var et = te.eventType;
        // CLICK_EVENT = 0 (or undefined per SDK normalization)
        if (et === 0 || et === undefined) {
          cur = (cur + 1) % 4;
          showScreen();
        }
        // DOUBLE_CLICK_EVENT = 3
        else if (et === 3) {
          cur = 0;
          showScreen();
        }
        // SCROLL_TOP_EVENT = 1
        else if (et === 1) {
          cur = (cur + 3) % 4;
          showScreen();
        }
      } catch (e) {
        // silently ignore event errors
      }
    });
  } catch (e) {
    // event registration failed — still show content
  }
}

async function showScreen() {
  if (!bridge) return;
  var c = screens[cur];
  try {
    await bridge.textContainerUpgrade({
      containerID: 1, containerName: 'main',
      content: c, contentOffset: 0, contentLength: c.length,
    });
  } catch (e) {
    try {
      await bridge.rebuildPageContainer({
        containerTotalNum: 1,
        textObject: [{
          xPosition: 0, yPosition: 0, width: 576, height: 288,
          borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0,
          containerID: 1, containerName: 'main',
          content: c, isEventCapture: 1,
        }],
      });
    } catch (e2) {}
  }
}

main();
