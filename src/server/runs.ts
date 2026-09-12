// 進行中の応答生成。クライアントが切断しても生成は続け、再接続したらバッファを再生してから live を流す
// ponytail: プロセス内 Map。複数インスタンスにするなら Redis pub/sub、再起動をまたぐなら部分保存に

export type Run<T> = {
  parentId: string | null
  events: T[]
  done: boolean
  error?: string
  abort: AbortController
  push(ev: T): void
  end(error?: string): void
  subscribe(signal?: AbortSignal): AsyncGenerator<T>
}

export function createRun<T>(parentId: string | null): Run<T> {
  let wake = Promise.withResolvers<void>()
  const run: Run<T> = {
    parentId,
    events: [],
    done: false,
    abort: new AbortController(),
    push(ev) {
      run.events.push(ev)
      wake.resolve()
      wake = Promise.withResolvers()
    },
    end(error) {
      run.done = true
      run.error = error
      wake.resolve()
    },
    async *subscribe(signal) {
      // 購読者の切断でも待機を解く (他の購読者も起きるが、条件を見直すだけなので無害)
      signal?.addEventListener('abort', () => wake.resolve(), { once: true })
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
