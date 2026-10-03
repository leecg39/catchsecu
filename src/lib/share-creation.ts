import { shareCreationResult } from "@/contracts/sharing";
import type { z } from "zod";

type Receipt = z.infer<typeof shareCreationResult>;
type Options = { send: (payload: string, key: string) => Promise<unknown>; makeKey?: () => string };
export class ShareCreationSession {
  private pending?: { payload: string; key: string };
  private uncertain = false;
  private receipt?: Receipt;
  private running?: Promise<Receipt>;
  constructor(private options: Options) {}
  get hasPending() { return !!this.pending; }
  submit(payload: string): Promise<Receipt> {
    if (this.receipt) return Promise.resolve(this.receipt);
    if (this.running) return this.running;
    if (this.pending && this.pending.payload !== payload) return Promise.reject(new Error("이전 초대 결과를 먼저 확인해주세요. 열람자와 공유 범위를 유지합니다."));
    this.pending ??= { payload, key: (this.options.makeKey ?? (() => crypto.randomUUID()))() };
    this.running = this.send().finally(() => { this.running = undefined; });
    return this.running;
  }
  retry(): Promise<Receipt> {
    if (!this.pending) return Promise.reject(new Error("초대할 열람자를 입력해주세요."));
    return this.submit(this.pending.payload);
  }
  private async send() {
    const request = this.pending!;
    try {
      const parsed = shareCreationResult.safeParse(await this.options.send(request.payload, request.key));
      const input = JSON.parse(request.payload) as { formId: string; formVersionId: string };
      if (!parsed.success || parsed.data.formId !== input.formId || parsed.data.formVersionId !== input.formVersionId)
        throw new Error("초대 결과를 확인할 수 없습니다. 같은 요청으로 다시 확인해주세요.");
      this.receipt = parsed.data; this.pending = undefined; this.uncertain = false; return this.receipt;
    } catch (cause) {
      const error = cause as { status?: unknown; code?: unknown };
      const rejected = typeof error?.status === "number" && error.status >= 400 && error.status < 500 && error.code !== "INVALID_RESPONSE";
      if (rejected && !this.uncertain) this.pending = undefined;
      else this.uncertain = true;
      throw cause;
    }
  }
}
