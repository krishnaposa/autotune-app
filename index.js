/**
 * Root entry — explicit path so Metro never confuses `App` with an `app/` route folder
 * (Windows resolves paths case-insensitively; expo/AppEntry uses `../../App`).
 */
import registerRootComponent from 'expo/src/launch/registerRootComponent';
import App from './App.tsx';

registerRootComponent(App);
