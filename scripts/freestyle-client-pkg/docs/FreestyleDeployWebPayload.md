# FreestyleDeployWebPayload


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**files** | [**Dict[str, FreestyleFile]**](FreestyleFile.md) | The files to deploy, a map of file paths to file contents, e.g. { \\\&quot;index.js\\\&quot;: {\\\&quot;content\\\&quot;: \\\&quot;your main\\\&quot;, \\\&quot;encoding\\\&quot;: \\\&quot;utf-8\\\&quot;}, \\\&quot;file2.js\\\&quot;: {\\\&quot;content\\\&quot;: \\\&quot;your helper\\\&quot; } }  **Do not include node modules in this bundle, they will not work**. Instead, includes a package-lock.json, bun.lockb, pnpm-lock.yaml, or yarn.lock, the node modules for the project will be installed from that lock file, or use the node_modules field in the configuration to specify the node modules to install. | 
**config** | [**FreestyleDeployWebConfiguration**](FreestyleDeployWebConfiguration.md) |  | [optional] 

## Example

```python
from freestyle_client.models.freestyle_deploy_web_payload import FreestyleDeployWebPayload

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleDeployWebPayload from a JSON string
freestyle_deploy_web_payload_instance = FreestyleDeployWebPayload.from_json(json)
# print the JSON string representation of the object
print(FreestyleDeployWebPayload.to_json())

# convert the object into a dict
freestyle_deploy_web_payload_dict = freestyle_deploy_web_payload_instance.to_dict()
# create an instance of FreestyleDeployWebPayload from a dict
freestyle_deploy_web_payload_from_dict = FreestyleDeployWebPayload.from_dict(freestyle_deploy_web_payload_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


