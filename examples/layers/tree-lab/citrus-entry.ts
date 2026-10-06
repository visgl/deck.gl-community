import {mountCitrusLabExample} from './citrus';
const container = document.querySelector<HTMLElement>('#app')!;
mountCitrusLabExample(container, {standalone: true});
