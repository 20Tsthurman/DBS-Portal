interface PlaceholderProps {
  eyebrow: string;
  title: string;
  description?: string;
}

export function Placeholder({
  eyebrow,
  title,
  description = "This section is coming soon.",
}: PlaceholderProps) {
  return (
    <section className="max-w-3xl">
      <p className="eyebrow mb-3">{eyebrow}</p>
      <h1 className="page-title mb-6">{title}</h1>
      <p
        style={{ color: "var(--text-body)", fontSize: "15px", lineHeight: 1.6 }}
      >
        {description}
      </p>
    </section>
  );
}
