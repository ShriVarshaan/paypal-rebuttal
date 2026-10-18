import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] border text-sm font-semibold transition-[background-color,color,border-color,transform] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "border-accent bg-accent px-4 text-white hover:bg-accent-strong",
        outline: "border-border-strong bg-surface px-4 text-foreground hover:bg-surface-subdued",
        ghost: "border-transparent bg-transparent px-3 text-foreground hover:bg-surface-subdued",
        icon: "size-11 border-border bg-surface p-0 text-foreground hover:border-border-strong hover:bg-surface-subdued",
      },
      size: {
        default: "h-11",
        compact: "h-9 min-h-9 px-3 text-xs",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ asChild = false, className, variant, size, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
