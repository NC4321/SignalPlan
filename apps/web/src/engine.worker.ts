import {
  handleRequest,
  transferables,
  type EngineRequest,
} from '@signalplan/engine'

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<EngineRequest>) => void,
  ): void
  postMessage(message: unknown, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope

scope.addEventListener('message', (event) => {
  const response = handleRequest(event.data)
  scope.postMessage(response, transferables(response))
})
