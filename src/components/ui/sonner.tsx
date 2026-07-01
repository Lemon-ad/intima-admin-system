import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          warning:
            "group-[.toaster]:!bg-background group-[.toaster]:!text-destructive group-[.toaster]:!border-destructive group-[.toaster]:!shadow-lg",
          error:
            "group-[.toaster]:!bg-background group-[.toaster]:!text-destructive group-[.toaster]:!border-destructive group-[.toaster]:!shadow-lg",
          success:
            "group-[.toaster]:!bg-emerald-50 group-[.toaster]:!text-emerald-900 group-[.toaster]:!border-emerald-300 dark:group-[.toaster]:!bg-emerald-950/40 dark:group-[.toaster]:!text-emerald-200 dark:group-[.toaster]:!border-emerald-700",
        },
      }}
      richColors
      {...props}
    />
  );
};

export { Toaster, toast };
