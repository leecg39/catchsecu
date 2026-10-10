import type { FormContent, FormRecord } from "@/contracts/forms";

export type FormDraftValue = { serviceId: string; title: string; content: FormContent };
export type DraftPhase = "idle" | "dirty" | "saving" | "saved" | "invalid" | "error" | "conflict";
export type DraftSnapshot = { record?: FormRecord; value: FormDraftValue; phase: DraftPhase; dirty: boolean; message: string; error: string };
type Pending = { record?: FormRecord; value: FormDraftValue; key: string; inputStamp: string };
type Options = { initial?: FormRecord; seed: FormDraftValue;
  validate: (value: FormDraftValue) => FormDraftValue;
  persist: (record: FormRecord | undefined, value: FormDraftValue, key: string) => Promise<FormRecord>;
  makeKey?: () => string; delay?: number };
export const draftValue = (record: FormRecord): FormDraftValue => ({ serviceId: record.serviceId, title: record.title, content: record.content });
const stamp = (value: FormDraftValue) => JSON.stringify(value);

// This state owns request ordering; React renders its immutable snapshots.
export class FormDraftSession {
  private snapshot: DraftSnapshot;
  private base: string;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private pending?: Pending;
  private running?: Promise<FormRecord | undefined>;
  private savingHolds = 0;
  constructor(private options: Options) {
    const value = structuredClone(options.initial ? draftValue(options.initial) : options.seed);
    this.base = stamp(value);
    this.snapshot = { record: options.initial, value, phase: "idle", dirty: false, message: "", error: "" };
  }
  getSnapshot = () => this.snapshot;
  hasPendingCreation = () => !!this.pending && !this.pending.record;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(patch: Partial<DraftSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.snapshot = { ...this.snapshot, dirty: stamp(this.snapshot.value) !== this.base || !!this.pending };
    this.listeners.forEach(listener => listener());
  }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private schedule() {
    this.clearTimer();
    if (this.active && this.snapshot.dirty && this.snapshot.phase === "dirty" && !this.running && !this.savingHolds)
      this.timer = setTimeout(() => { this.timer = null; void this.save(); }, this.options.delay ?? 1200);
  }
  start() { this.active = true; this.schedule(); }
  stop() { this.active = false; this.clearTimer(); }
  /** Acquire before asynchronous asset work; a save already in flight cannot be paused. */
  pauseSaving = (): (() => void) | undefined => {
    if (this.running) return undefined;
    this.savingHolds++; this.clearTimer();
    let released = false;
    return () => { if (released) return; released = true; this.savingHolds--; this.schedule(); };
  };
  edit(value: FormDraftValue) {
    const serviceId = this.snapshot.record?.serviceId ?? this.pending?.value.serviceId;
    if (serviceId) value = { ...value, serviceId };
    const phase = this.running ? "saving" : ["error", "conflict"].includes(this.snapshot.phase) ? this.snapshot.phase : "dirty";
    this.emit({ value: structuredClone(value), phase, ...(phase === "dirty" ? { error: "", message: "변경 내용을 저장할 예정입니다." } : {}) });
    if (phase === "dirty" && !this.snapshot.dirty) this.emit({ phase: "saved", message: "저장된 내용과 같습니다." });
    this.schedule();
  }
  save(force = false): Promise<FormRecord | undefined> {
    this.clearTimer();
    if (this.savingHolds) return Promise.resolve(undefined);
    if (this.running) return this.running;
    if (this.snapshot.phase === "conflict") return Promise.resolve(undefined);
    if (!this.snapshot.dirty && !force) return Promise.resolve(this.snapshot.record);
    this.running = this.flush(force).finally(() => { this.running = undefined; this.schedule(); });
    return this.running;
  }
  private async flush(force: boolean): Promise<FormRecord | undefined> {
    while (this.snapshot.dirty || this.pending || force) {
      if (!this.pending) {
        let value: FormDraftValue;
        try { value = this.options.validate(structuredClone(this.snapshot.value)); }
        catch (cause) { this.emit({ phase: "invalid", error: cause instanceof Error ? cause.message : "입력 내용을 확인해주세요.", message: "입력을 마치면 자동저장합니다." }); return undefined; }
        this.pending = { record: this.snapshot.record, value, key: (this.options.makeKey ?? (() => crypto.randomUUID()))(), inputStamp: stamp(this.snapshot.value) };
      }
      force = false;
      const pending = this.pending;
      this.emit({ phase: "saving", error: "", message: "서버에 저장 중입니다…" });
      try {
        const record = await this.options.persist(pending.record, structuredClone(pending.value), pending.key);
        const value = draftValue(record), unchanged = stamp(this.snapshot.value) === pending.inputStamp;
        this.base = stamp(value); this.pending = undefined;
        const current = unchanged ? value : this.snapshot.value;
        const dirty = stamp(current) !== this.base;
        this.emit({ record, value: current, phase: dirty ? "dirty" : "saved", error: "", message: dirty ? "추가 변경 내용을 저장합니다." : "서버에 저장했습니다." });
      } catch (cause) {
        const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
        // An uncertain response keeps the exact key/payload/version for explicit retry.
        if (status >= 400 && status < 500) this.pending = undefined;
        this.emit({ phase: status === 409 ? "conflict" : "error", error: cause instanceof Error ? cause.message : "저장 결과를 확인할 수 없습니다.",
          message: status === 409 ? "다른 곳에서 수정되었습니다. 이 화면의 수정 내용은 유지했습니다." : "수정 내용이 이 화면에 남아 있습니다. 저장을 다시 시도해주세요." });
        return undefined;
      }
    }
    return this.snapshot.record;
  }
  load(record: FormRecord) {
    if (this.running || this.savingHolds) throw new Error("저장과 파일 업로드가 끝난 뒤 최신본을 불러와주세요.");
    this.clearTimer(); this.pending = undefined;
    const value = structuredClone(draftValue(record)); this.base = stamp(value);
    this.emit({ record, value, phase: "saved", error: "", message: "최신 내용을 불러왔습니다." });
  }
}
