// What the upload stages mean to a person (backend D28).
export const STAGES = [
  ['queued', 'Waiting'],
  ['reading', 'Reading'],
  ['importing', 'Importing'],
  ['saving', 'Saving'],
  ['completed', 'Done'],
];

export const isFinished = (upload) => upload.stage === 'completed' || upload.stage === 'failed';

export function stageLabel(stage) {
  if (stage === 'failed') return 'Failed';
  return STAGES.find(([key]) => key === stage)?.[1] ?? stage;
}

// Same limits as the backend (10 MB, .csv/.xlsx); checked here only so the
// user hears about it before waiting for an upload. The backend decides.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'];

export function checkFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) return 'Old .xls files are not supported. Open it in Excel and save as .xlsx or CSV.';
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'Only .csv and .xlsx bank statements can be uploaded.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'This file is larger than 10 MB.';
  return null;
}

// Friendlier words for the upload errors the backend can return.
export const UPLOAD_ERROR_TEXT = {
  DUPLICATE_FILE: 'You have already uploaded this exact file.',
  PAYLOAD_TOO_LARGE: 'This file is larger than 10 MB.',
  FILE_TOO_LARGE: 'This file is larger than 10 MB.',
};
