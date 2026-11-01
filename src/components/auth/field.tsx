/** A labelled text box for the sign-in screens: 56px tall and 16px text, so phones do not zoom in on focus. */
export function Field({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[0.82rem] font-bold">{label}</span>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-14 rounded-[18px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20 disabled:opacity-60"
      />
    </label>
  );
}
