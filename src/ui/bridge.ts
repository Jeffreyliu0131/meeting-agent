export async function api(method: string, args?: unknown) {
  const result = await window.meeting.call(method, args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
