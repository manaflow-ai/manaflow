# FreestyleVerifyDomainRequest

Verify a domain verification request, can either be done for a domain, or for a specific request

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**domain** | **str** |  | 
**id** | **str** |  | 

## Example

```python
from freestyle_client.models.freestyle_verify_domain_request import FreestyleVerifyDomainRequest

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleVerifyDomainRequest from a JSON string
freestyle_verify_domain_request_instance = FreestyleVerifyDomainRequest.from_json(json)
# print the JSON string representation of the object
print(FreestyleVerifyDomainRequest.to_json())

# convert the object into a dict
freestyle_verify_domain_request_dict = freestyle_verify_domain_request_instance.to_dict()
# create an instance of FreestyleVerifyDomainRequest from a dict
freestyle_verify_domain_request_from_dict = FreestyleVerifyDomainRequest.from_dict(freestyle_verify_domain_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


