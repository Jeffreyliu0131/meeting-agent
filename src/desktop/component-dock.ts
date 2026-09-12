import { screen, type BrowserWindow } from 'electron';
import type { Snapshot } from '../contracts/model';
import type { ComponentDockView } from '../contracts/component-dock';

/** One fixed native region. Automatic display never requests focus or publishes content. */
export class ComponentDock {
  readonly window: BrowserWindow;
  private selectedId: string | null = null;
  private meetingId: string | null = null;
  private pinned = false;
  private leaveTimer?: ReturnType<typeof setTimeout>;
  constructor(private ports: {
    state: () => Snapshot | null;
    create: (options: Electron.BrowserWindowConstructorOptions, role: string) => BrowserWindow;
    request: (method: string, args?: unknown) => Promise<any>;
  }) {
    this.window = ports.create({ width: 300, height: 320, frame: false, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#F5F7FB',
      title: '待审核组件' }, 'component-dock');
    this.window.webContents.on('did-finish-load', () => this.sync());
  }
  view(): ComponentDockView {
    const state = this.ports.state();
    const m = state?.meetings.find(m => m.status === 'active');
    if (this.meetingId !== (m?.id ?? null)) {
      this.meetingId = m?.id ?? null;
      this.selectedId = null; this.pinned = false;
    }
    const s = m?.collaboration;
    const cards = (s?.components ?? []).filter(c => {
      if (c.needsReview || c.draftRevision === c.publishedRevision) return false;
      if (c.draftState === 'ready') return true;
      if (c.draftState !== 'collecting') return false;
      const content = c.revisions.at(-1)!.content;
      // A collector with actual content stays visible as later utterances fill it.
      return content.kind === 'poll' ? !!content.payload.question.trim() && content.payload.options.some(o => o.label.trim())
        : content.kind === 'assignment' ? content.payload.items.some(i => i.title.trim())
        : content.kind === 'conflict' ? content.payload.sides.some(i => i.title.trim())
        : !!content.payload.statement.trim();
    }).map(c => ({ id: c.id, revision: c.draftRevision, content: c.revisions.at(-1)!.content,
      preparing: c.draftState === 'collecting' || !!s?.jobs.some(j => j.componentId === c.id && ['pending','running'].includes(j.status)) }));
    if (this.selectedId && !s?.components.some(c => c.id === this.selectedId)) {
      this.selectedId = null; this.pinned = false;
    }
    return {meetingId: this.meetingId, locale: state?.preferences.uiLocale ?? 'zh-CN', cards,
      selectedId: this.selectedId, pinned: this.pinned};
  }
  sync() {
    if (this.window.isDestroyed()) return;
    const view = this.view();
    const work = screen.getPrimaryDisplay().workArea;
    const expanded = !!view.selectedId;
    const width = Math.min(expanded ? 920 : 300, work.width - 24);
    const height = Math.min(expanded ? 760 : 74 + Math.min(view.cards.length, 3) * 146, work.height - 48);
    const bounds = {x:work.x+work.width-width-16, y:work.y+Math.min(80,Math.max(16,work.height-height-16)),width,height};
    const old = this.window.getBounds();
    if (Object.keys(bounds).some(k => old[k as keyof typeof old] !== bounds[k as keyof typeof bounds])) this.window.setBounds(bounds);
    this.window.webContents.send('snapshot', view);
    if (view.meetingId && (view.cards.length || view.selectedId)) {
      if (!this.window.isVisible()) this.window.showInactive();
    } else this.window.hide();
  }
  async handle(method: string, args: any) {
    const view = this.view();
    const s = this.ports.state()?.meetings.find(m => m.id === view.meetingId)?.collaboration;
    const host = s?.participants.find(p => p.role === 'host');
    if (method === 'componentDockSnapshot') return view;
    if (method === 'componentDockInspect') {
      if (!view.cards.some(c => c.id === args?.componentId)) throw Error('COMPONENT_NOT_FOUND');
      clearTimeout(this.leaveTimer);
      if (!this.pinned || args?.pin === true) {
        this.selectedId = args.componentId; this.pinned = args.pin === true;
        this.sync();
        if (this.pinned) this.window.focus();
      }
      return true;
    }
    if (method === 'componentDockHold') {
      clearTimeout(this.leaveTimer);
      if (args?.held === false && !this.pinned)
        this.leaveTimer = setTimeout(() => { if (!this.pinned) {this.selectedId=null;this.sync();} }, 350);
      return true;
    }
    if (method === 'componentDockCollapse') {
      clearTimeout(this.leaveTimer); this.selectedId=null;this.pinned=false;this.sync();return true;
    }
    if (!host || !view.selectedId) throw Error('PERMISSION_DENIED');
    if (method === 'collaborationSnapshot') {
      const result = await this.ports.request(method, {meetingId:view.meetingId,actorId:host.id});
      return {...result, assignmentDirectory:result.components.flatMap((c:any)=>c.draft?.content.kind==='assignment'?c.draft.content.payload.items:[]),
        components:result.components.filter((c:any)=>c.id===view.selectedId)};
    }
    if (method === 'collaborationCommand' && args?.meetingId === view.meetingId && args?.payload?.componentId === view.selectedId) {
      this.pinned=true;
      return this.ports.request(method, {command:args,actorId:host.id});
    }
    throw Error('PERMISSION_DENIED');
  }
}
