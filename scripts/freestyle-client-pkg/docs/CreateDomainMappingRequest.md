# CreateDomainMappingRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**deployment_id** | **str** |  | 

## Example

```python
from freestyle_client.models.create_domain_mapping_request import CreateDomainMappingRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateDomainMappingRequest from a JSON string
create_domain_mapping_request_instance = CreateDomainMappingRequest.from_json(json)
# print the JSON string representation of the object
print(CreateDomainMappingRequest.to_json())

# convert the object into a dict
create_domain_mapping_request_dict = create_domain_mapping_request_instance.to_dict()
# create an instance of CreateDomainMappingRequest from a dict
create_domain_mapping_request_from_dict = CreateDomainMappingRequest.from_dict(create_domain_mapping_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


