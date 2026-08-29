import React from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Modal, Btn } from "@/components/crm/kit";
import { Copy, QrCode } from "lucide-react";
import { toast } from "sonner";

// Reusable QR poster modal — renders a QR for `url`, with download-PNG and
// print-poster actions. Used for campaign capture forms and event check-in.
export function QrPosterModal({ open, onClose, url, name, subtitle = "Scan to open the form", cta = "Scan to connect" }) {
  const ref = React.useRef(null);
  const getCanvas = () => ref.current?.querySelector("canvas");

  const download = () => {
    const c = getCanvas();
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `${(name || "boothiq").replace(/[^a-z0-9]+/gi, "-")}-qr.png`;
    a.click();
  };

  const printPoster = () => {
    const c = getCanvas();
    if (!c) return;
    const data = c.toDataURL("image/png");
    const w = window.open("", "_blank", "width=800,height=1000");
    if (!w) return toast.error("Enable pop-ups to print the poster");
    w.document.write(`<!doctype html><html><head><title>${name} — QR Poster</title>
      <style>body{font-family:'Plus Jakarta Sans',Arial,sans-serif;text-align:center;padding:64px 40px;color:#0F172A}
      .ey{letter-spacing:.25em;text-transform:uppercase;color:#047857;font-weight:800;font-size:14px}
      h1{font-size:44px;margin:12px 0 4px}p.sub{font-size:22px;color:#334155;margin:0 0 32px}
      img{width:400px;height:400px}p.cta{font-size:28px;font-weight:800;color:#047857;margin-top:28px}
      p.ft{color:#94a3b8;margin-top:40px;font-size:13px}</style></head>
      <body><div class="ey">BoothIQ</div><h1>${name}</h1>
      <p class="sub">${subtitle}</p>
      <img src="${data}"/><p class="cta">📱 ${cta}</p>
      <p class="ft">${url}</p></body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <Modal open={open} onClose={onClose} title="QR Poster">
      {url && (
        <div className="text-center">
          <div ref={ref} className="mx-auto mb-4 inline-flex rounded-2xl border border-slate-200 bg-white p-5">
            <QRCodeCanvas value={url} size={240} fgColor="#0F172A" level="M" includeMargin data-testid="qr-canvas" />
          </div>
          <p className="font-display text-lg font-bold text-slate-900">{name}</p>
          <p className="mb-1 text-sm text-slate-500">{subtitle}</p>
          <p className="mb-4 break-all text-xs text-slate-400">{url}</p>
          <div className="flex justify-center gap-2">
            <Btn data-testid="qr-download" variant="ghost" onClick={download}><Copy className="h-4 w-4" /> Download PNG</Btn>
            <Btn data-testid="qr-print" onClick={printPoster}><QrCode className="h-4 w-4" /> Print Poster</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
