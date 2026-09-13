// 進行中の応答生成。クライアントが切断しても生成は続け、再接続したらバッファを再生してから live を流す
// ponytail: プロセス内 Map。複数インスタンスにするなら Redis pub/sub、再起動をまたぐなら部分保存に

export type Run<T> = {
  parentId: string | null
  events: T[]
  done: boolean
  error?: string
  abort: AbortController
  pending: Map<string, PromiseWithResolvers<boolean>> // 承認待ちの function_call (call_id → 決定)
  push(ev: T): void
  end(error?: string): void
  subscribe(signal?: AbortSignal): AsyncGenerator<T>
}

export function createRun<T>(parentId: string | null): Run<T> {
  let wake = Promise.withResolvers<void>()
  // 待機中の購読者を全員起こす。必ず新しい promise に差し替える (解決済みのまま残すと、後から来た購読者が
  // 解決済み promise を await し続けてマイクロタスクでイベントループを塞ぐ)
  const notify = () => {
    wake.resolve()
    wake = Promise.withResolvers()
  }
  const run: Run<T> = {
    parentId,
    events: [],
    done: false,
    abort: new AbortController(),
    pending: new Map(),
    push(ev) {
      run.events.push(ev)
      notify()
    },
    end(error) {
      run.done = true
      run.error = error
      notify()
    },
    async *subscribe(signal) {
      // 購読者の切断でも待機を解く (他の購読者も起きるが、条件を見直して待ち直すだけ)
      signal?.addEventListener('abort', notify, { once: true })
      for (let i = 0; !signal?.aborted; i++) {
        while (i >= run.events.length && !run.done && !signal?.aborted) await wake.promise
        if (i >= run.events.length) return
        yield run.events[i]
      }
    },
  }
  return run
}

// conversationId → 進行中の run (1 会話につき同時に 1 つ)
export const runs = new Map<string, Run<unknown>>()
