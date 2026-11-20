import React, { useRef } from 'react';
import { ANSI_47_ROWS, Midi47LayoutId, resolveKey47 } from '../audio/midi47';

interface Keyboard47Props {
  layout: Midi47LayoutId;
  octaveShift: number;
  activeCodes: ReadonlySet<string>;
  onTriggerKey: (code: string, midi: number) => void;
}

// Authentic ANSI physical row stagger offsets (in rem) for 13 / 13 / 11 / 10 key rows
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
                  className="relative flex flex-col items-center justify-between flex-1 max-w-[62px] h-9 px-1 py-1 rounded-[5px] border transition-transform duration-75 cursor-pointer"
                  style={{
                    transform: isPressed ? 'translateY(1px) scale(0.96)' : 'translateY(0)',
                    backgroundColor: isPressed
                      ? `hsl(${resolved.hue}, 90%, 54%)`
                      : isSharp
                        ? '#171c28'
                        : '#252c3e',
                    borderColor: isPressed
                      ? `hsl(${resolved.hue}, 95%, 72%)`
                      : isSharp
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(255,255,255,0.16)',
                    color: isPressed ? '#ffffff' : isSharp ? '#9aa6bf' : '#e4eaf5',
                  }}
                >
                  <span className="font-mono text-[10px] font-semibold leading-none">
                    {keyDef.label}
                  </span>
                  <span
                    className="font-mono text-[9px] leading-none tabular-nums"
                    style={{ opacity: isPressed ? 1 : 0.65 }}
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
