import {Log, COLOR} from 'probe.gl';

export const log = new Log({id: 'react-graph-gl'}).enable();

log.log({color: COLOR.CYAN}, 'Initialize react-graph-gl logger.')();
