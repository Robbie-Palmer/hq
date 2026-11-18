import type { Metadata } from "next";
import { AnnotationWorkbench } from "@/app/_projects/annotation-workbench/components/annotation-workbench";

export const metadata: Metadata = {
  title: "Annotation Workbench",
  description:
    "Review model-assisted image annotations against their source objects.",
  robots: { index: false, follow: false },
};

export default function AnnotationWorkbenchPage() {
  return <AnnotationWorkbench />;
}
