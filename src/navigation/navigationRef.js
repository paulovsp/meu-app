// Permite navegar de fora da árvore de componentes (ex: listener de
// notificação push) — padrão recomendado pela própria documentação do
// React Navigation pra esse caso.
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();
