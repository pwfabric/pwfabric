/** Test fixture: the smallest heading block. */
export default function Block(props: Record<string, unknown>): string {
  return String(props.text ?? props.content ?? props.label ?? '')
}
