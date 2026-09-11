export type RenderReport = {
  ok: boolean;
  issues: Array<{
    blockId: string | null;
    errorCode: string;
    width?: number;
    height?: number;
    viewport?: number;
  }>;
};
export class RenderFailure extends Error {
  constructor(readonly report: RenderReport) {
    super(report.issues[0]?.errorCode ?? 'RENDER_FAILED');
  }
}
