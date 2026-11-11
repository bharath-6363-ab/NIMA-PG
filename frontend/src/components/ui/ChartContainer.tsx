import { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export function ChartContainer({
  title,
  subtitle,
  action,
  footer,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <CardBody className="pt-4">
        {children}
        {footer ? (
          <div className="mt-4 border-t border-slate-100 pt-3">{footer}</div>
        ) : null}
      </CardBody>
    </Card>
  );
}

