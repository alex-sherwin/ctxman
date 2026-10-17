import {
  FieldError,
  Input,
  Label,
  Button as AriaButton,
  SearchField as AriaSearchField,
  Text,
  TextArea,
  TextField as AriaTextField,
  type SearchFieldProps as AriaSearchFieldProps,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from 'react-aria-components';
import { kitClass } from './utils.ts';

interface FieldBase {
  label?: string;
  description?: string;
  errorMessage?: string | ((v: ValidationResult) => string);
  size?: 'sm' | 'md' | 'lg';
  mono?: boolean;
  placeholder?: string;
  /** `data-testid` of the `<input>` / `<textarea>` element (tests type into it). */
  inputTestId?: string;
}

export interface TextFieldProps extends AriaTextFieldProps, FieldBase {}
/** `label` is optional, so pass `aria-label` when there is none. */
export interface SearchFieldProps extends AriaSearchFieldProps, FieldBase {}
export interface TextAreaFieldProps extends AriaTextFieldProps, FieldBase {
  /** Default 3. */
  rows?: number;
}

function FieldMeta({ description, errorMessage }: Pick<FieldBase, 'description' | 'errorMessage'>) {
  return (
    <>
      {description && (
        <Text slot="description" className="ck-field__description">
          {description}
        </Text>
      )}
      <FieldError className="ck-field__error">{errorMessage}</FieldError>
    </>
  );
}

/** Single-line text input. */
export function TextField({
  label,
  description,
  errorMessage,
  size = 'md',
  mono,
  placeholder,
  inputTestId,
  className,
  ...rest
}: TextFieldProps) {
  return (
    <AriaTextField
      {...rest}
      className={kitClass(className, 'ck-field', `ck-field--${size}`, mono && 'ck-field--mono')}
    >
      {label && <Label className="ck-field__label">{label}</Label>}
      <Input className="ck-input" placeholder={placeholder} data-testid={inputTestId} />
      <FieldMeta description={description} errorMessage={errorMessage} />
    </AriaTextField>
  );
}

/** Search input with a leading icon and a clear button. Esc clears when non-empty. */
export function SearchField({
  label,
  description,
  errorMessage,
  size = 'md',
  mono,
  placeholder,
  inputTestId,
  className,
  ...rest
}: SearchFieldProps) {
  return (
    <AriaSearchField
      {...rest}
      className={kitClass(
        className,
        'ck-field',
        'ck-searchfield',
        `ck-field--${size}`,
        mono && 'ck-field--mono',
      )}
    >
      {label && <Label className="ck-field__label">{label}</Label>}
      <div className="ck-searchfield__box">
        <span className="ck-searchfield__icon" aria-hidden="true">
          <svg
            viewBox="0 0 16 16"
            width="100%"
            height="100%"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 14 14" />
          </svg>
        </span>
        <Input className="ck-input" placeholder={placeholder} data-testid={inputTestId} />
        <AriaButton className="ck-searchfield__clear" aria-label="Clear search">
          ×
        </AriaButton>
      </div>
      <FieldMeta description={description} errorMessage={errorMessage} />
    </AriaSearchField>
  );
}

/** Plain multi-line prose. Markdown, JSON and YAML input uses `CodeEditor` instead. */
export function TextAreaField({
  label,
  description,
  errorMessage,
  size = 'md',
  mono,
  placeholder,
  inputTestId,
  rows = 3,
  className,
  ...rest
}: TextAreaFieldProps) {
  return (
    <AriaTextField
      {...rest}
      className={kitClass(className, 'ck-field', `ck-field--${size}`, mono && 'ck-field--mono')}
    >
      {label && <Label className="ck-field__label">{label}</Label>}
      <TextArea
        className="ck-input ck-input--multiline"
        rows={rows}
        placeholder={placeholder}
        data-testid={inputTestId}
      />
      <FieldMeta description={description} errorMessage={errorMessage} />
    </AriaTextField>
  );
}
