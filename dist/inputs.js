// Input name mapping: "scan_results_path" → ASPEN_SCAN_RESULTS_PATH

export function getInput(name) {
  const envKey = `ASPEN_${name.toUpperCase().replace(/-/g, '_')}`;
  return process.env[envKey]?.trim() ?? '';
}

export function getRequiredInput(name) {
  const value = getInput(name);
  if (!value) {
    const envKey = `ASPEN_${name.toUpperCase().replace(/-/g, '_')}`;
    throw new Error(
      `Required input "${name}" is missing. Set the ${envKey} environment variable.`,
    );
  }
  return value;
}

export function parseBoolean(value, defaultValue = true) {
  if (!value) return defaultValue;
  return value.trim() !== 'false';
}

export function parseJsonArray(raw, fieldName) {
  const input = (raw ?? '').trim();
  if (!input || input === '[]') return [];
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
    return parsed.map(String);
  } catch (e) {
    throw new Error(
      `Invalid value for "${fieldName}": ${e.message}. Expected a JSON array, e.g. '["CWE-79","CWE-89"]'`,
    );
  }
}

/**
 * Parses ASPEN_EXCLUDE_GIT_METADATA_FIELDS.
 *
 * Returns the string 'all' to suppress the entire git block (disables Adapt / CWE recording),
 * or a string[] of specific field names to omit from the git block.
 *
 * Accepted values:
 *   all              → omit the git block entirely
 *   '["repo"]'       → omit specific fields
 *   ''  / unset      → no exclusions
 *
 * @returns {'all' | string[]}
 */
export function parseExcludeFields(raw) {
  const input = (raw ?? '').trim();
  if (input === 'all') return 'all';
  return parseJsonArray(input, 'exclude_git_metadata_fields');
}
