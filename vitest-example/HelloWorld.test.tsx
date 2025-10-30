import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import HelloWorld from './HelloWorld.tsx'

test('renders name', async () => {
  const { getByText } = await render(<HelloWorld name="Vitest" />)
  await expect.element(getByText('Hello Vitest!')).toBeInTheDocument()
})
