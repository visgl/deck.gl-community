import React, {useCallback} from 'react';
import styles from './input.module.css';

function RangeInput({name, min, max, step, displayName, displayValue, onChange}) {
  const onInput = useCallback(
    evt => {
      const {value} = evt.target;
      let newValue = Number(value);
      if (min !== undefined) {
        newValue = Math.max(min, newValue);
      }
      if (max !== undefined) {
        newValue = Math.min(max, newValue);
      }
      onChange(name, newValue);
    },
    [min, max, onChange]
  );

  return (
    <div className={styles.inputContainer}>
      <label>{displayName}</label>
      <div className="tooltip">
        {displayName}: {String(displayValue)}
      </div>
      <input type="range" min={min} max={max} value={displayValue} step={step} onChange={onInput} />
    </div>
  );
}

function Checkbox({name, value, displayName, displayValue, onChange}) {
  const onInput = useCallback(
    evt => {
      const newValue = evt.target.checked;
      onChange(name, newValue);
    },
    [onChange]
  );

  return (
    <div className={styles.inputContainer}>
      <label>{displayName}</label>
      <div className="tooltip">
        {displayName}: {String(displayValue)}
      </div>
      <input type="checkbox" checked={value} onChange={onInput} />
    </div>
  );
}

export default function GenericInput(props) {
  const {name, onChange, displayName, altValue, displayValue, ...otherProps} = props;

  const onInput = useCallback(
    evt => {
      onChange(name, evt.target.value);
    },
    [onChange]
  );

  const reset = useCallback(() => {
    onChange(name, altValue);
  }, [altValue, onChange]);

  const inputProps = otherProps;

  switch (props.type) {
    case 'link':
      return (
        <div className={styles.inputContainer}>
          <label>{displayName}</label>
          <a href={displayValue} target="_new">
            {displayValue}
          </a>
        </div>
      );

    case 'function':
    case 'json':
      const editable = Boolean(altValue);
      return (
        <div className={styles.inputContainer}>
          <label>{displayName}</label>
          <button type="text" disabled={!editable} onClick={reset}>
            {displayValue}
          </button>
        </div>
      );

    case 'select':
      return (
        <div className={styles.inputContainer}>
          <label>{displayName}</label>
          <select onChange={onInput} value={displayValue}>
            {props.options.map((value, i) => (
              <option key={i} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      );

    case 'checkbox':
      return <Checkbox {...props} />;

    case 'range':
      return <RangeInput {...props} />;

    default:
      return (
        <div className={styles.inputContainer}>
          <label>{displayName}</label>
          <div className="tooltip">
            {displayName}: {String(displayValue)}
          </div>
          <input {...inputProps} value={displayValue} onChange={onInput} />
        </div>
      );
  }
}
