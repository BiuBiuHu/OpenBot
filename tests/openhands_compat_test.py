import importlib.util,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('compat',Path(__file__).resolve().parents[1]/'runtime/openhands/install.py')
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i)
class CompatTests(unittest.TestCase):
 def test_optional_field_patch_is_idempotent_and_fail_closed(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);source=root/'lib/python3.12/site-packages/openhands/sdk/llm/utils/telemetry.py';source.parent.mkdir(parents=True)
   source.write_text('value = (\n details.cache_creation_tokens\n)\n')
   self.assertTrue(i.apply_usage_compatibility(root));self.assertFalse(i.apply_usage_compatibility(root))
   namespace={'details':type('Details',(),{})()};exec(source.read_text(),namespace);self.assertEqual(namespace['value'],0)
   namespace={'details':type('Details',(),{'cache_creation_tokens':42})()};exec(source.read_text(),namespace);self.assertEqual(namespace['value'],42)
   source.write_text('unexpected SDK source')
   with self.assertRaises(RuntimeError):i.apply_usage_compatibility(root)
if __name__=='__main__':unittest.main()
