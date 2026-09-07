declare module '@dawsonxiong/react-native-latex-renderer/lib/module/MathView' {
  import type { NamedExoticComponent } from 'react';
  import type { StyleProp, ViewStyle } from 'react-native';

  interface MathViewProps {
    math: string;
    fontSize?: number;
    color?: string;
    style?: StyleProp<ViewStyle>;
    onError?: (error: Error, latex: string) => void;
    debug?: boolean;
  }

  export const MathView: NamedExoticComponent<MathViewProps>;
}
