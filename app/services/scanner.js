// QR-skanning med bakkameraet via lokal html5-qrcode (/lib/html5-qrcode.min.js).

export class QrScanner {
  constructor(elementId, onCode, onStatus) {
    this.elementId = elementId;
    this.onCode = onCode;
    this.onStatus = onStatus;
    this.instance = null;
    this.running = false;
    this.starting = null;
    this.paused = false;
    this.last = { text: null, at: 0 };
  }

  lib() {
    const L = window.__Html5QrcodeLibrary__;
    if (!L?.Html5Qrcode) throw new Error('Skannerbiblioteket mangler');
    return L;
  }

  async start() {
    if (this.running || this.starting) return this.starting;
    this.starting = (async () => {
      try {
        const L = this.lib();
        if (!this.instance) {
          this.instance = new L.Html5Qrcode(this.elementId, {
            formatsToSupport: [L.Html5QrcodeSupportedFormats.QR_CODE],
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
            verbose: false,
          });
        }
        await this.instance.start(
          { facingMode: 'environment' },
          { fps: 12, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.8); return { width: s, height: s }; }, disableFlip: true },
          (text) => this.handle(text),
          () => {},
        );
        this.running = true;
        this.onStatus?.('ok');
      } catch (e) {
        this.running = false;
        this.onStatus?.('error', e);
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  handle(text) {
    if (this.paused) return;
    const now = Date.now();
    // Samme kode innen 3 sek ignoreres (kameraet leser samme merke mange ganger i sekundet).
    if (text === this.last.text && now - this.last.at < 3000) return;
    this.last = { text, at: now };
    this.onCode(text, 'qr');
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; this.last = { text: null, at: 0 }; }

  async stop() {
    if (this.starting) await this.starting;
    if (!this.running || !this.instance) return;
    try { await this.instance.stop(); } catch { /* allerede stoppet */ }
    this.running = false;
  }
}
