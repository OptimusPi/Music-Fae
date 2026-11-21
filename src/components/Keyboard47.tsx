import React, { useRef } from 'react';
import { ANSI_47_ROWS, Midi47LayoutId, resolveKey47 } from '../audio/midi47';

interface Keyboard47Props {
  layout: Midi47LayoutId;
  octaveShift: number;
  activeCodes: ReadonlySet<string>;
  onTriggerKey: (code: string, midi: number) => void;
}

const ROW_OFFSETS = ['pl-0', 'pl-4', 'pl-7', 'pl-11'];

export const Keyboard47: React.FC<Keyboard47Props> = ({
  layout,
  octaveShift,
  activeCodes,
  onTriggerKey,
}) => {
  const draggingRef = useRef(false);
  const lastDragCodeRef = useRef<string | null>(null);

  const handlePress = (code: string, midi: number) => {
    lastDragCodeRef.current = code;
    onTriggerKey(code, midi);
  };

  return (
    <div
      className="w-full rounded-lg bg-[#0c0f16] border border-white/10 p-2 select-none"
      onPointerLeave={() => {
        draggingRef.current = false;
        lastDragCodeRef.current = null;
      }}
      onPointerUp={() => {
        draggingRef.current = false;
        lastDragCodeRef.current = null;
      }}
    >
      <div className="flex flex-col gap-1">
        {ANSI_47_ROWS.map((row, rowIdx) => (
          <div key={rowIdx} className={`flex items-center gap-1 ${ROW_OFFSETS[rowIdx]}`}>
            {row.map((keyDef) => {
              const resolved = resolveKey47(layout, keyDef.code, octaveShift);
              if (!resolved) return null;
              const isPressed = activeCodes.has(keyDef.code);
              const isSharp = resolved.isAccidental;

              return (
                <button
                  key={keyDef.code}
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    draggingRef.current = true;
                    handlePress(keyDef.code, resolved.midi);
                  }}
                  onPointerEnter={() => {
                    if (draggingRef.current && lastDragCodeRef.current !== keyDef.code) {
                      handlePress(keyDef.code, resolved.midi);
                    }
                  }}
                  className={`relative flex flex-col items-center justify-between flex-1 max-w-[62px] h-9 px-1 py-1 rounded-[5px] border transition-transform duration-75 cursor-pointer ${
                    isPressed
                      ? 'translate-y-px scale-95 bg-amber-400 border-amber-200 text-slate-950 font-semibold'
                      : isSharp
                        ? 'bg-[#171c28] border-white/8 text-slate-400 hover:border-white/20'
                        : 'bg-[#252c3e] border-white/16 text-slate-100 hover:border-white/30'
                  }`}
                >
                  <span className="font-mono text-[10px] font-semibold leading-none">
                    {keyDef.label}
                  </span>
                  <span
                    className={`font-mono text-[9px] leading-none tabular-nums ${
                      isPressed ? 'opacity-100' : 'opacity-65'
                    }`}
                  >
                    {resolved.noteName}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
