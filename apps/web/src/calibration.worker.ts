import {
  handleCalibrationRequest,
  type CalibrationMessage,
  type CalibrationRequest,
} from '@signalplan/engine'

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<CalibrationRequest>) => void,
  ): void
  postMessage(message: CalibrationMessage): void
}

const scope = self as unknown as WorkerScope

// A band at a time, in the order asked (D76).
scope.addEventListener('message', (event) => {
  scope.postMessage(handleCalibrationRequest(event.data))
})
