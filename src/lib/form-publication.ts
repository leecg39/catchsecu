import type { FormRecord } from "@/contracts/forms";

type Options = { read: (id: string) => Promise<FormRecord>;
  publish: (id: string, version: number, key: string) => Promise<unknown>; makeKey?: () => string };
function denied(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }

// Permission reads stay outside mutation caches; uncertain writes keep their key.
export class FormPublicationSession {
  private pending?: { id: string; version: number; key: string };
  private running?: Promise<FormRecord>;
  constructor(private options: Options) {}
  publish(saved: FormRecord): Promise<FormRecord> {
    if (this.running) return this.running;
    this.running = this.commit(saved).finally(() => { this.running = undefined; });
    return this.running;
  }
  private async commit(saved: FormRecord) {
    const current = await this.options.read(saved.id);
    if (current.id !== saved.id) denied(409, "캐치폼을 다시 선택해주세요.");
    if (!current.hasDraft) {
      if (!current.actions?.share) denied(403, "현재 게시된 캐치폼을 공유할 권한이 없거나 링크가 종료되었습니다.");
      this.pending = undefined; return current;
    }
    if (current.version !== saved.version) denied(409, "다른 곳에서 수정되었습니다. 최신 내용을 불러온 뒤 게시해주세요.");
    if (!current.actions?.publish) denied(403, "이 서비스의 캐치폼 게시 권한이 없습니다.");
    if (this.pending?.id !== saved.id || this.pending.version !== saved.version)
      this.pending = { id: saved.id, version: saved.version, key: (this.options.makeKey ?? (() => crypto.randomUUID()))() };
    await this.options.publish(saved.id, saved.version, this.pending.key);
    const published = await this.options.read(saved.id);
    if (published.id !== saved.id || !published.actions?.share) denied(403, "현재 공유 권한과 게시 상태를 다시 확인해주세요.");
    this.pending = undefined; return published;
  }
}
