export interface NativeFieldValidation {
  label: string;
  type: string;
  min: string;
  max: string;
  minLength: number;
  maxLength: number;
  validity: Pick<ValidityState, 'valueMissing' | 'typeMismatch' | 'tooShort' | 'tooLong' | 'rangeUnderflow' | 'rangeOverflow' | 'stepMismatch' | 'badInput' | 'patternMismatch'>;
}

export function nativeValidationMessage(field: NativeFieldValidation): string {
  const label = field.label.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim() || 'Isian ini';
  if (field.validity.valueMissing) return field.type === 'checkbox' ? `${label} perlu dicentang sebelum melanjutkan.` : `${label} wajib diisi.`;
  if (field.validity.typeMismatch) return field.type === 'email' ? `${label}: masukkan alamat email yang valid.` : `${label}: masukkan alamat yang valid.`;
  if (field.validity.tooShort) return `${label} minimal ${field.minLength} karakter.`;
  if (field.validity.tooLong) return `${label} maksimal ${field.maxLength} karakter.`;
  if (field.validity.rangeUnderflow) return `${label} minimal ${field.min}.`;
  if (field.validity.rangeOverflow) return `${label} maksimal ${field.max}.`;
  if (field.validity.badInput || field.validity.stepMismatch) return `${label}: periksa angka yang dimasukkan.`;
  return `${label}: periksa kembali format isian ini.`;
}
