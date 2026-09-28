import {
  handlePlacementRequest,
  type PlacementMessage,
  type PlacementRequest,
} from '@signalplan/engine'

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<PlacementRequest>) => void,
  ): void
  postMessage(message: PlacementMessage): void
}

const scope = self as unknown as WorkerScope

// One search per worker: cancelling terminates it (D42).
scope.addEventListener('message', (event) => {
  handlePlacementRequest(event.data, (message) => scope.postMessage(message))
})
