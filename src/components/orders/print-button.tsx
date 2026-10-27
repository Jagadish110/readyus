'use client';

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-11 items-center rounded-full bg-leaf-600 px-6 text-sm font-bold text-white print:hidden"
    >
      Print or save as PDF
    </button>
  );
}
