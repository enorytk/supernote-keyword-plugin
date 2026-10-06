import {DeviceEventEmitter} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

export const KEYWORD_BUTTON_ID = 100;
export const KEYWORD_BUTTON_PRESS = 'keyword-suggestor:press';

let pendingPresses = 0;
let started = false;

// Register outside React so a toolbar press cannot arrive before App's effects
// are mounted. PluginHost opens the UI after it dispatches this event.
export function startKeywordButtonListener() {
  if (started) {return;}
  started = true;
  PluginManager.registerButtonListener({
    onButtonPress(event) {
      if (event?.id !== KEYWORD_BUTTON_ID) {return;}
      pendingPresses += 1;
      DeviceEventEmitter.emit(KEYWORD_BUTTON_PRESS);
    },
  });
}

export function consumePendingPress() {
  if (pendingPresses < 1) {return false;}
  pendingPresses -= 1;
  return true;
}
