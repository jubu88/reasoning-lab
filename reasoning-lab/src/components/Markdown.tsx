import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders LLM output as markdown. Links open in a new tab; everything else is
// styled by the .md scope in index.css. Safe by construction — react-markdown
// builds React elements, no raw HTML injection.
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
