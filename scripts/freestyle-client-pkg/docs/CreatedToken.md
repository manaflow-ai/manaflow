# CreatedToken


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**token** | **str** |  | 

## Example

```python
from freestyle_client.models.created_token import CreatedToken

# TODO update the JSON string below
json = "{}"
# create an instance of CreatedToken from a JSON string
created_token_instance = CreatedToken.from_json(json)
# print the JSON string representation of the object
print(CreatedToken.to_json())

# convert the object into a dict
created_token_dict = created_token_instance.to_dict()
# create an instance of CreatedToken from a dict
created_token_from_dict = CreatedToken.from_dict(created_token_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


