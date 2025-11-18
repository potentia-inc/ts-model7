import * as extended from 'jest-extended'
import * as mongodb from '@potentia/mongodb7/jest'
import * as util from '@potentia/util/jest'

expect.extend({ ...extended.default, ...mongodb, ...util })
