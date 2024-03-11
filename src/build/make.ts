import { basename, dirname } from 'path'
import { BlobEntry } from '../blobs/entry'
import { PartitionProps } from '../blobs/props'
import { DeviceConfig } from '../config/device'
import { SelinuxPartResolutions } from '../selinux/contexts'
import { MAKEFILE_HEADER } from '../util/headers'

const CONT_SEPARATOR = ' \\\n    '

const SEPOLICY_PARTITION_VARS: { [part: string]: string } = {
  system_ext: 'SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS',
  product: 'PRODUCT_PRIVATE_SEPOLICY_DIRS',
  vendor: 'BOARD_VENDOR_SEPOLICY_DIRS',
  odm: 'BOARD_ODM_SEPOLICY_DIRS',
}

const VINTF_MANIFEST_PARTITION_VARS: { [part: string]: string } = {
  system_ext: 'SYSTEM_EXT_MANIFEST_FILES',
  product: 'PRODUCT_MANIFEST_FILES',
  vendor: 'DEVICE_MANIFEST_FILE', // no 'S'
  odm: 'ODM_MANIFEST_FILES',
}

export interface Symlink {
  moduleName: string
  linkPartition: string
  linkSubpath: string
  targetPath: string
}

export interface ModulesMakefile {
  device: string
  vendor: string

  radioFiles?: Array<string>

  symlinks: Array<Symlink>
}

export interface BoardMakefile {
  buildPartitions?: Array<string>
  abOtaPartitions?: Array<string>

  boardInfo?: string
  sepolicyResolutions?: SelinuxPartResolutions
}

export interface DeviceMakefile {
  namespaces?: Array<string>
  copyFiles?: Array<string>
  packages?: Array<string>

  vintfManifestPaths?: Map<string, string>

  vendorLinkerConfigPath?: string

  props?: PartitionProps
  fingerprint?: string
  enforceRros?: string
}

export interface ProductsMakefile {
  products: Array<string>
}

export interface ProductMakefile {
  baseProductPath: string

  name: string
  model: string
  brand: string
  manufacturer: string

  enforceRros?: string
}

function startBlocks() {
  return [MAKEFILE_HEADER]
}

function finishBlocks(blocks: Array<string>) {
  return `${blocks.join('\n\n')}\n`
}

export function sanitizeBasename(path: string) {
  return basename(path).replaceAll(/[^a-z0-9_\-.]/g, '_')
}

function partPathToMakePath(partition: string, subpath: string) {
  let copyPart = partition == 'system' ? 'PRODUCT_OUT' : `TARGET_COPY_OUT_${partition.toUpperCase()}`
  return `$(${copyPart})/${subpath}`
}

export function blobToFileCopy(entry: BlobEntry, proprietaryDir: string) {
  let destPath = partPathToMakePath(entry.partition, entry.path)
  return `${proprietaryDir}/${entry.srcPath}:${destPath}`
}

export function serializeModulesMakefile(mk: ModulesMakefile) {
  let blocks = startBlocks()
  blocks.push('LOCAL_PATH := $(call my-dir)', `ifeq ($(TARGET_DEVICE),${mk.device})`)

  if (mk.radioFiles != undefined) {
    blocks.push(`RADIO_FILES := $(wildcard $(LOCAL_PATH)/firmware/*.img)
$(foreach f, $(notdir $(RADIO_FILES)),$(call add-radio-file,firmware/$(f)))`)
  }

  if (mk.symlinks.length > 0) {
    let mkdirCmds = new Set<string>()
    let linkCmds = []
    for (let link of mk.symlinks) {
      let destPath = `$(PRODUCT_OUT)/${link.linkPartition}/${link.linkSubpath}`
      mkdirCmds.add(`mkdir -p ${dirname(destPath)};`)
      linkCmds.push(`ln -sf ${link.targetPath} ${destPath};`)
    }

    blocks.push(`include $(CLEAR_VARS)
LOCAL_MODULE := device_symlinks
LOCAL_MODULE_CLASS := ETC
LOCAL_MODULE_TAGS := optional
LOCAL_MODULE_OWNER := ${mk.vendor}
LOCAL_MODULE_PATH := $(TARGET_OUT_VENDOR_ETC)
LOCAL_MODULE_STEM := .device_symlinks
LOCAL_SRC_FILES := Android.mk
LOCAL_POST_INSTALL_CMD := \\
    ${Array.from(mkdirCmds).join(CONT_SEPARATOR)} \\
    ${linkCmds.join(CONT_SEPARATOR)}
include $(BUILD_PREBUILT)`)
  }

  blocks.push('endif')
  return finishBlocks(blocks)
}

function addContBlock(blocks: Array<string>, variable: string, items: Array<string> | undefined) {
  if (items != undefined && items.length > 0) {
    blocks.push(`${variable} += \\
    ${items.join(CONT_SEPARATOR)}`)
  }
}

export function serializeBoardMakefile(mk: BoardMakefile, config?: DeviceConfig) {
  let blocks = startBlocks()

  let systemFsType = config?.device?.system_fs_type ?? 'ext4'

  // Build vendor?
  if (mk.buildPartitions?.includes('vendor')) {
    blocks.push(`BOARD_VENDORIMAGE_FILE_SYSTEM_TYPE := ${systemFsType}`)
  }

  // Build DLKM partitions?
  if (mk.buildPartitions?.includes('vendor_dlkm')) {
    blocks.push(`BOARD_USES_VENDOR_DLKMIMAGE := true
BOARD_VENDOR_DLKMIMAGE_FILE_SYSTEM_TYPE := ${systemFsType}
TARGET_COPY_OUT_VENDOR_DLKM := vendor_dlkm`)
  }
  if (mk.buildPartitions?.includes('odm_dlkm')) {
    blocks.push(`BOARD_USES_ODM_DLKIMAGE := true
BOARD_ODM_DLKIMAGE_FILE_SYSTEM_TYPE := ${systemFsType}
TARGET_COPY_OUT_ODM_DLKM := odm_dlkm`)
  }

  addContBlock(blocks, 'AB_OTA_PARTITIONS', mk.abOtaPartitions)

  if (mk.boardInfo != undefined) {
    blocks.push(`TARGET_BOARD_INFO_FILE := ${mk.boardInfo}`)
  }

  if (mk.sepolicyResolutions != undefined) {
    for (let [partition, { sepolicyDirs, missingContexts }] of mk.sepolicyResolutions.entries()) {
      let partVar = SEPOLICY_PARTITION_VARS[partition]
      if (sepolicyDirs.length > 0) {
        addContBlock(blocks, partVar, sepolicyDirs)
      }

      if (missingContexts.length > 0) {
        blocks.push(missingContexts.map(c => `# Missing ${partition} SELinux context: ${c}`).join('\n'))
      }
    }
  }

  return finishBlocks(blocks)
}

export function serializeDeviceMakefile(mk: DeviceMakefile) {
  let blocks = startBlocks()

  addContBlock(blocks, 'PRODUCT_SOONG_NAMESPACES', mk.namespaces)

  if (mk.vintfManifestPaths != undefined) {
    for (let [partition, manifestPath] of mk.vintfManifestPaths.entries()) {
      blocks.push(`${VINTF_MANIFEST_PARTITION_VARS[partition]} += ${manifestPath}`)
    }
  }

  if (mk.vendorLinkerConfigPath !== undefined) {
    blocks.push(`PRODUCT_VENDOR_LINKER_CONFIG_FRAGMENTS += ${mk.vendorLinkerConfigPath}`)
  }

  if (mk.props != undefined) {
    for (let [partition, props] of mk.props.entries()) {
      if (props.size == 0) {
        continue
      }

      let propLines = Array.from(props.entries()).map(([k, v]) => `${k}=${v}`)

      blocks.push(`PRODUCT_${partition.toUpperCase()}_PROPERTIES += \\
    ${propLines.join(CONT_SEPARATOR)}`)
    }
  }

  if (mk.fingerprint != undefined) {
    blocks.push(`PRODUCT_OVERRIDE_FINGERPRINT := ${mk.fingerprint}`)
  }

  if (mk.enforceRros != undefined) {
    blocks.push(`PRODUCT_ENFORCE_RRO_TARGETS := ${mk.enforceRros}`)
  }

  addContBlock(blocks, 'PRODUCT_PACKAGES', mk.packages)
  addContBlock(blocks, 'PRODUCT_COPY_FILES', mk.copyFiles)

  return finishBlocks(blocks)
}

export function serializeProductMakefile(mk: ProductMakefile, config?: DeviceConfig) {
  let blocks = startBlocks()

  blocks.push(`# Inherit AOSP product
$(call inherit-product, ${mk.baseProductPath})`)

  blocks.push(`# Match stock product info
PRODUCT_NAME := ${mk.name}
PRODUCT_MODEL := ${mk.model}
PRODUCT_BRAND := ${mk.brand}
PRODUCT_MANUFACTURER := ${mk.manufacturer}`)

  if (mk.enforceRros != undefined) {
    blocks.push(`PRODUCT_ENFORCE_RRO_TARGETS := ${mk.enforceRros}`)
  }

  let extraMakefiles = config?.platform?.extra_product_makefiles
  if (extraMakefiles !== undefined && extraMakefiles.length > 0) {
    for (let mk of extraMakefiles) {
      blocks.push(`include ${mk}`)
    }
  }

  let build_id = config?.device?.build_id

  if (build_id !== undefined) {
    blocks.push(`ifneq ($(BUILD_ID),${build_id})
  $(error BUILD_ID: expected ${build_id}, got $(BUILD_ID))
endif`)
  }

  let splOverride = config?.device?.platform_security_patch_level_override
  if (splOverride !== undefined) {
    blocks.push(`ifneq ($(PLATFORM_SECURITY_PATCH),${splOverride})
  $(error PLATFORM_SECURITY_PATCH: expected ${splOverride}, got $(PLATFORM_SECURITY_PATCH))
endif`)
  }

  return finishBlocks(blocks)
}

export function serializeProductsMakefile(mk: ProductsMakefile) {
  let blocks = [MAKEFILE_HEADER]

  addContBlock(
    blocks,
    'PRODUCT_MAKEFILES',
    mk.products.map(p => `$(LOCAL_DIR)/${p}.mk`),
  )

  return finishBlocks(blocks)
}
