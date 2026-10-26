import { LaunchArguments } from 'react-native-launch-arguments';
import { PieChart } from 'react-native-gifted-charts';

const args = LaunchArguments.value<{ VitrinDemo?: boolean; VitrinScreen?: string; vitrinDemo?: boolean }>();
export const isVitrinDemo = Boolean(args.VitrinDemo ?? args.vitrinDemo);
