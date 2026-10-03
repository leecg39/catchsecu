import { submissionReceiptSchema, type SubmissionReceipt } from "@/contracts/public-forms";

type Options = { send: (payload: string, key: string) => Promise<unknown>; makeKey?: () => string };
export class PublicSubmissionSession {
  private pending?: { payload: string; key: string };
  private uncertain = false;
  private receipt?: SubmissionReceipt;
  private running?: Promise<SubmissionReceipt>;
  constructor(private options: Options) {}
  get hasPending() { return !!this.pending; }
  submit(payload: string): Promise<SubmissionReceipt> {
    if (this.receipt) return Promise.resolve(this.receipt);
    if (this.running) return this.running;
    if (this.pending && this.pending.payload !== payload)
      return Promise.reject(new Error("이전 제출 결과를 먼저 확인해주세요. 같은 요청의 입력 내용과 첨부를 유지합니다."));
    this.pending ??= { payload, key: (this.options.makeKey ?? (() => crypto.randomUUID()))() };
    this.running = this.send().finally(() => { this.running = undefined; });
    return this.running;
  }
  retry(): Promise<SubmissionReceipt> {
    if (this.receipt) return Promise.resolve(this.receipt);
    if (!this.pending) return Promise.reject(new Error("제출할 응답을 입력해주세요."));
    return this.submit(this.pending.payload);
  }
  private async send() {
    const request = this.pending!;
    try {
      const result = submissionReceiptSchema.safeParse(await this.options.send(request.payload, request.key));
      if (!result.success) throw new Error("접수 결과를 확인할 수 없습니다. 같은 요청으로 다시 확인해주세요.");
      this.receipt = result.data; this.pending = undefined; this.uncertain = false; return this.receipt;
    } catch (cause) {
      const error = cause as { status?: unknown; code?: unknown };
      const rejected = typeof error?.status === "number" && error.status >= 400 && error.status < 500 && error.code !== "INVALID_RESPONSE";
      if (rejected && !this.uncertain) this.pending = undefined;
      else this.uncertain = true;
      throw cause;
    }
  }
}
