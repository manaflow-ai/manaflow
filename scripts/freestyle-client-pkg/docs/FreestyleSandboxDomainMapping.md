# FreestyleSandboxDomainMapping


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**domain** | **str** |  | 
**deployment_id** | **str** |  | 
**ownership_id** | **str** |  | 
**created_at** | **datetime** |  | 

## Example

```python
from freestyle_client.models.freestyle_sandbox_domain_mapping import FreestyleSandboxDomainMapping

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleSandboxDomainMapping from a JSON string
freestyle_sandbox_domain_mapping_instance = FreestyleSandboxDomainMapping.from_json(json)
# print the JSON string representation of the object
print(FreestyleSandboxDomainMapping.to_json())

# convert the object into a dict
freestyle_sandbox_domain_mapping_dict = freestyle_sandbox_domain_mapping_instance.to_dict()
# create an instance of FreestyleSandboxDomainMapping from a dict
freestyle_sandbox_domain_mapping_from_dict = FreestyleSandboxDomainMapping.from_dict(freestyle_sandbox_domain_mapping_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


