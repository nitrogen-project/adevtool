import { promises as fs } from 'fs'

import { DeviceConfig } from '../config/device'
import { PropResults } from './generate'
import { VendorDirectories } from '../blobs/build'

function createReadme(device: string, friendlyDevice: string) {
  // Hard-coded here for convenient formatting
  return `# ${friendlyDevice} vendor module

This is an automatically-generated vendor module to build AOSP for the ${friendlyDevice} (codename \`${device}\`).

Generated by [adevtool](https://github.com/GrapheneOS/adevtool). [More info](https://github.com/GrapheneOS/adevtool/blob/main/README.md)
`
}

function getFriendlyName(props: PropResults) {
  let product = props.stockProps.get('product')!
  let manufacturer = product.get('ro.product.product.manufacturer')!
  let model = product.get('ro.product.product.model')!
  return `${manufacturer} ${model}`
}

export async function writeReadme(config: DeviceConfig, dirs: VendorDirectories, props: PropResults | null) {
  let friendlyDevice = props === null ? config.device.name : getFriendlyName(props)
  let readme = createReadme(config.device.name, friendlyDevice)
  await fs.writeFile(`${dirs.out}/README.md`, readme)
}
