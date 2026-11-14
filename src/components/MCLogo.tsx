import React from 'react';

export function MCLogo({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-[#0B1120] border border-slate-700/80 shadow-sm ${className}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-slate-900/60 pointer-events-none" />
      <div className="relative flex items-baseline tracking-tight z-10 select-none">
        <span
          className="text-white font-serif font-medium"
          style={{ fontSize: "1.45em", lineHeight: 1 }}
        >
          M
        </span>
        <span
          className="text-blue-400 font-serif font-semibold italic -ml-0.5"
          style={{ fontSize: "1.6em", lineHeight: 1 }}
        >
          C
        </span>
      </div>
    </div>
  );
}
