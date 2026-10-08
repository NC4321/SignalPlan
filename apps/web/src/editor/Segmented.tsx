/**
 * A row of joined buttons, one of which is chosen: radio buttons styled as
 * the top bar's band and unit switches. `value` may be undefined until one
 * is chosen.
 */
export function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string
  name: string
  value: T | undefined
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}
