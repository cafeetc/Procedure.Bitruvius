import React, { useState } from 'react';
import { Check, Copy, Database, Download, FileCode2, Image as ImageIcon, Upload, X } from 'lucide-react';

interface ExportModalProps {
  open: boolean;
  jsonPayload: string;
  catalogJsonPayload: string;
  onClose: () => void;
  onExportPng: () => void;
  onExportBsk: () => void;
  onExportCatalogJson: () => void;
  onImportJson: (raw: string) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  jsonPayload,
  catalogJsonPayload,
  onClose,
  onExportPng,
  onExportBsk,
  onExportCatalogJson,
  onImportJson,
}) => {
  const [payloadView, setPayloadView] = useState<'rig' | 'catalog'>('rig');
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  if (!open) return null;

  const displayedJson = payloadView === 'rig' ? jsonPayload : catalogJsonPayload;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayedJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setImportError('Clipboard write failed in this browser context.');
    }
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);
    if (!importText.trim()) {
      setImportError('Paste a valid RigStatePayload or Stance Catalog JSON object first.');
      return;
    }
    try {
      onImportJson(importText);
      setImportText('');
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid JSON payload');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="w-full max-w-xl rounded-md border border-[#2b2f36] bg-[#191b1f] p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[#2b2f36] pb-3.5">
          <div>
            <h2 id="export-modal-title" className="font-display text-[16px] font-semibold text-[#e6e8ec]">
              Export &amp; JSON Database
            </h2>
            <p className="mt-0.5 text-[12px] text-[#8b919c]">
              Download studio PNGs, `.bsk.json` skeletons, or exchange rig &amp; stance catalog JSON.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close export modal"
            onClick={onClose}
            className="rounded border border-[#2b2f36] bg-[#0e0f11] p-1.5 text-[#8b919c] transition-colors hover:border-[#ef4444]/70 hover:text-[#fca5a5]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {/* File Downloads */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={onExportPng}
              className="flex items-center justify-center gap-1.5 rounded border border-[#a855f7] bg-[#7e22ce] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#9333ea]"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Studio PNG
            </button>
            <button
              type="button"
              onClick={onExportBsk}
              className="flex items-center justify-center gap-1.5 rounded border border-[#2b2f36] bg-[#0e0f11] px-3 py-2 text-[12px] font-semibold text-[#e6e8ec] transition-colors hover:border-[#22c55e] hover:text-[#86efac]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              .bsk.json
            </button>
            <button
              type="button"
              onClick={onExportCatalogJson}
              className="flex items-center justify-center gap-1.5 rounded border border-[#2b2f36] bg-[#0e0f11] px-3 py-2 text-[12px] font-semibold text-[#e6e8ec] transition-colors hover:border-[#22c55e] hover:text-[#86efac]"
            >
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              Stance JSON
            </button>
          </div>

          {/* Canonical JSON Toggle + Copy */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex rounded border border-[#2b2f36] bg-[#0e0f11] p-0.5">
                <button
                  type="button"
                  onClick={() => setPayloadView('rig')}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    payloadView === 'rig'
                      ? 'bg-[#7e22ce]/35 text-[#f3e8ff]'
                      : 'text-[#8b919c] hover:text-[#e6e8ec]'
                  }`}
                >
                  <FileCode2 className="h-3.5 w-3.5 text-[#a855f7]" aria-hidden="true" />
                  Active Rig JSON
                </button>
                <button
                  type="button"
                  onClick={() => setPayloadView('catalog')}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    payloadView === 'catalog'
                      ? 'bg-[#22c55e]/20 text-[#86efac]'
                      : 'text-[#8b919c] hover:text-[#e6e8ec]'
                  }`}
                >
                  <Database className="h-3.5 w-3.5 text-[#22c55e]" aria-hidden="true" />
                  Stance Catalog JSON
                </button>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded border border-[#2b2f36] bg-[#0e0f11] px-2.5 py-1 text-[11.5px] font-medium text-[#e6e8ec] transition-colors hover:border-[#a855f7]"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-[#4ade80]" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
            <pre className="font-mono-tabular max-h-32 overflow-auto rounded border border-[#2b2f36] bg-[#0e0f11] p-3 text-[11px] leading-relaxed text-[#9ca3af]">
              {displayedJson}
            </pre>
          </div>

          {/* Import JSON */}
          <form onSubmit={handleImportSubmit} className="space-y-2 border-t border-[#2b2f36] pt-3.5">
            <label htmlFor="import-json-input" className="block text-[12px] font-medium text-[#b4bac4]">
              Import RigStatePayload or Stance Catalog JSON
            </label>
            <textarea
              id="import-json-input"
              rows={3}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='Paste RigStatePayload JSON or {"stances": [...]} catalog JSON'
              className="font-mono-tabular w-full rounded border border-[#2b2f36] bg-[#0e0f11] p-2.5 text-[11.5px] text-[#e6e8ec] placeholder-[#525866] focus:border-[#a855f7] focus:outline-none"
            />
            {importError && (
              <p className="text-[12px] text-[#fca5a5]" role="alert">
                {importError}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded border border-[#22c55e]/70 bg-[#22c55e]/15 px-3 py-1.5 text-[12px] font-medium text-[#86efac] transition-colors hover:bg-[#22c55e]/25"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Apply Imported JSON
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
