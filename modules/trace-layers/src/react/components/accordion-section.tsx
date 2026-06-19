import {AccordionContent, AccordionItem, AccordionTrigger} from './ui';
import {WithTooltip} from './with-tooltip';

export {Accordion} from './ui';

export function AccordionSection(props: {
  sectionId: string;
  title: string;
  tooltip: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={props.sectionId}>
      <AccordionTrigger className="px-0 gap-1">
        <WithTooltip tooltip={props.tooltip}>
          <div className="flex items-center text-muted-foreground">
            {props.icon}
            <h3 className="ml-1 text-xs uppercase font-bold"> {props.title} </h3>
          </div>
        </WithTooltip>
      </AccordionTrigger>
      <AccordionContent className="pb-5 pt-1 px-[5px]"> {props.children} </AccordionContent>
    </AccordionItem>
  );
}
