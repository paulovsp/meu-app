import 'react-native-gesture-handler';
// Versão de computador: limita a largura antes de qualquer tela carregar.
import './src/web/larguraMaxima';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
